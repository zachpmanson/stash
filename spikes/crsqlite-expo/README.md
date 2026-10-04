# Stash CR-SQLite / Expo feasibility spike

Disposable Android-only slice; it does not change Stash's production database, app configuration, or dependency lockfile.

## What it checks

- Expo SDK 55's existing `expo-sqlite.loadExtensionAsync` API can be built into an Android arm64 APK with CR-SQLite's upstream native library.
- On-device, two independent Expo SQLite connections can each write offline, exchange `crsql_changes` rows, and converge.
- On-device, Stash's current `serializeAsync` database-backup primitive preserves CRR rows/schema metadata through serialization and restore.
- On the host/server side, a Node 24 `node:sqlite` process can load the upstream Linux x86_64 build, exchange changes between independent SQLite databases, and serialize/restore CRR data.

The native client test is an in-process exchange between two SQLite connections, not the eventual HTTP/WebSocket transport. No transport, auth, or production migration is included.

## Build the arm64 Android app

From the Stash repo root (the build uses the repository's capped Gradle runner):

```sh
nix develop . --command bash -c '
  cd spikes/crsqlite-expo
  ./scripts/prepare-android-crsqlite.sh
  ANDROID_HOME="$HOME/android-sdk" NODE_ENV=production ../../node_modules/.bin/expo prebuild --platform android --clean
'
ANDROID_HOME="$HOME/android-sdk" /home/beltino/beltino/scripts/build-capped.sh \
  "$PWD/spikes/crsqlite-expo" -- assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Install the resulting `spikes/crsqlite-expo/android/app/build/outputs/apk/release/app-release.apk` on an **arm64** Android device. Open **CR-SQLite Expo Spike** and tap **Run spike**; all three reported checks must pass. The `10.0.0.118` Pixel was not reachable over ADB when this spike was built, and the available local emulator images are x86_64, so the on-device assertions remain unrun.

The binary fetch is pinned to CR-SQLite v0.16.3; no compiled binary is committed. The config plugin copies the upstream `aarch64-linux-android` `.so` into `jniLibs/arm64-v8a`. The APK build passed for that ABI and contains `lib/arm64-v8a/libcrsqlite.so`; it is **not** evidence of multi-ABI support.

## Test the host/server SQLite side

Requires Node 24 and the project's devshell:

```sh
cd spikes/crsqlite-expo
./scripts/prepare-linux-peer.sh
node ./scripts/test-linux-peer.mjs
```

This validates bidirectional CR-SQLite change exchange and backup serialization in Node's SQLite implementation, not Expo/Android-to-server wire transport.

## Early schema finding / remaining gate

CR-SQLite v0.16.3 rejects CRR tables with a `NOT NULL` non-key column that has no default. The existing Stash schema has several such columns; those definitions need an intentional defaults/nullability migration or this choice needs revisiting. Before adopting CRRs, still test the native screen on a real arm64 Android device, exercise the actual populated Stash DB/backup ZIP, settle field semantics and schema evolution, and source supported binaries for every target ABI. iOS is out of scope for this spike. Do not enable CRRs in Stash's real database yet.
