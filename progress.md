# Stash sync/restore and deployability progress

_Last updated: 2026-10-19 (Melbourne time)_

## Goal
Finish the experimental Android CR-SQLite reconnect and restore lifecycle safely, validate it on the Pixel 8 with disposable server data, and assess whether the sync backend is ready to deploy and inspect. Production sync must remain disabled until reviewed.

## Prior verified work
- Reconnect serialization is committed as `dada2ca` on `falco/stash-reconnect`; draft PR [zpm/stash#58](https://github.com/zachpmanson/stash/pull/58) targets `backend`.
- Two same-process Disconnect → offline-write → reconnect cycles converged on Pixel 8.
- In a later disposable run, deletion propagation was confirmed: deleting a synced item in the app removed it from the test server.
- A disposable server-written item was synced to the app and backed up. The backup was made, but the file picker/restore → reconnect sequence was not completed.
- No production sync was enabled, deployed, or used. The prior debug install, test server, Caddy proxy, ADB reverse, and disposable DB data were cleaned up.

## Current changes (checkpoint authorized by Zach)
- `src/db/database.ts`: serialize DB ownership across app reads/writes, backup staging, and replacement; finalize CR-SQLite before closing the DB and fail closed after unsafe cleanup/replacement failures.
- `src/db/syncClient.ts`: track and cancel connection setup; drain active sync/projection work; prevent connections during restore. To address the reviewer's indefinite wait finding, `networkConfig()` now provides a replica over the DB and site ID already prepared by the connection attempt, avoiding a second DB open/read inside `createSyncedDB()`.
- `src/utils/backup.ts`: stage consistent backups under DB ownership and run restore under the sync restore and DB replacement locks.
- `patches/@vlcn.io__ws-client@0.2.0.patch`: stop stale callbacks, delayed startup, outbound retries, and transport reopen after teardown; keep the lockfile patch hash in sync.
- App DB callers and replica helpers now acquire ownership before resolving handles; lifecycle and transport regression scripts cover the changes.

## Current validation
- Latest validation (`proc_31c6`) passed: 18 database/sync lifecycle tests, TypeScript (`tsc --noEmit`), 14 websocket teardown tests, `pnpm lint`, and `git diff --check`.
- Observer regression coverage includes throwing per-connection and subscribed listeners, synchronous restore reentrancy during connecting/connected notifications, and draining pending replica reads before restore.
- Corrected the queued-setup test to allow deferred setup to actually enqueue behind the held DB owner before cancellation; corrected the connection-result assertion to inspect `.stop`.
- These are mocked lifecycle/transport tests, not native-device restore validation.
- First fresh arm64 debug build failed in generated React Native autolinking Java: `ReactNativeApplicationEntryPoint.java` referenced `com.zachmanson.stash.reconnect.BuildConfig`, while current Android namespace is `com.zachmanson.stash`.
- A clean + rebuild attempt failed during `make clean` before rebuilding: CMake/Ninja could not find generated JNI codegen directories for MapLibre, AsyncStorage, and zip-archive dependencies. This leaves the package mismatch unresolved.
- `nix develop --command pnpm lint` and `git diff --check` passed after the latest sync-provider change.
- ADB sees the Pixel 8 as `3A111FDJH0062B`. The isolated debug package was uninstalled at prior cleanup; main app/data are separate and untouched.

## Paused state
Zach authorized committing the validated progress. This checkpoint is being committed and pushed to the existing branch; implementation, build troubleshooting, lifecycle review, and remaining device tests remain paused. Nothing has been deployed and production sync remains disabled.

## Remaining gates if work resumes
1. Fix/verify generated Android package configuration and complete an arm64 debug build.
2. Review the lifecycle code directly for race/cleanup regressions (subagent review attempts failed; no reviewer edits).
3. Reinstall isolated debug APK on Pixel 8; run disposable sync, delete propagation, backup → restore, and reconnect; collect server-side and local evidence.
4. Audit server deployment/configuration, health/operational observability, schema compatibility, and rollback/backup requirements. Do not deploy production sync as part of this validation.
5. Clean up disposable services/data/reverse tunnel and the isolated debug app.
